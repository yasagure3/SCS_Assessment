terraform {
  required_providers {
    aws        = { source = "hashicorp/aws" }
    cloudflare = { source = "cloudflare/cloudflare" }
  }
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["trial", "prod"], var.environment)
    error_message = "Use a separate trial or prod state."
  }
}
variable "suffix" { type = string }
variable "aws_account_id" { type = string }
variable "cloudflare_account_id" { type = string }
variable "backup_expiry_confirmed" {
  type        = bool
  default     = false
  description = "Enable 30-day expiration only after reviewing the dry-run inventory."
}
locals {
  name         = "scs-assessment-${var.environment}-${var.suffix}"
  scan_name    = "scs-${var.environment}-scan-${var.aws_account_id}-${var.suffix}"
  managed_rule = "arn:aws:events:ap-northeast-1:${var.aws_account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
}
module "cognito" {
  source                = "../cognito"
  user_pool_name        = "${local.name}-pool"
  user_pool_client_name = "${local.name}-client"
  create_test_user      = false
  deletion_protection   = var.environment == "prod" ? "ACTIVE" : "INACTIVE"
}
resource "cloudflare_d1_database" "main" {
  account_id = var.cloudflare_account_id
  name       = "${local.name}-db"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_d1_database" "restore" {
  account_id = var.cloudflare_account_id
  name       = "${local.name}-restore-db"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_r2_bucket" "private" {
  for_each   = toset(["evidence", "backup", "restore"])
  account_id = var.cloudflare_account_id
  name       = "${local.name}-${each.key}"
  location   = "apac"
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_r2_bucket_lifecycle" "backup" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.private["backup"].name
  rules = [{
    id                                 = "confirmed-30-day-backup-expiry"
    enabled                            = var.backup_expiry_confirmed
    conditions                         = { prefix = "snapshots/" }
    delete_objects_transition          = { condition = { type = "Age", max_age = 2592000 } }
    abort_multipart_uploads_transition = { condition = { type = "Age", max_age = 86400 } }
  }]
}
resource "aws_s3_bucket" "scan" {
  bucket        = local.scan_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "scan" {
  bucket                  = aws_s3_bucket.scan.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "scan" {
  bucket = aws_s3_bucket.scan.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "scan" {
  bucket = aws_s3_bucket.scan.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "scan" {
  bucket = aws_s3_bucket.scan.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
# Scan copies are temporary; official evidence remains in R2. Failed copies are
# also removed after 7 days. A missing/expired copy never means a clean verdict.
resource "aws_s3_bucket_lifecycle_configuration" "scan" {
  bucket = aws_s3_bucket.scan.id
  rule {
    id     = "temporary-scan-copies"
    status = "Enabled"
    filter { prefix = "scan/" }
    expiration { days = 7 }
    noncurrent_version_expiration { noncurrent_days = 7 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_iam_role" "scanner" {
  name               = "${local.name}-guardduty"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "malware-protection-plan.guardduty.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = var.aws_account_id }, ArnLike = { "aws:SourceArn" = "arn:aws:guardduty:ap-northeast-1:${var.aws_account_id}:malware-protection-plan/*" } } }] })
}
resource "aws_iam_role_policy" "scanner" {
  role = aws_iam_role.scanner.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"], Resource = local.managed_rule, Condition = { StringLike = { "events:ManagedBy" = "malware-protection-plan.guardduty.amazonaws.com" } } },
    { Effect = "Allow", Action = ["events:DescribeRule", "events:ListTargetsByRule"], Resource = local.managed_rule },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObjectTagging", "s3:GetObjectTagging", "s3:PutObjectVersionTagging", "s3:GetObjectVersionTagging"], Resource = "${aws_s3_bucket.scan.arn}/scan/*" },
    { Effect = "Allow", Action = ["s3:ListBucket", "s3:PutBucketNotification", "s3:GetBucketNotification"], Resource = aws_s3_bucket.scan.arn },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.scan.arn}/malware-protection-resource-validation-object" }
  ] })
}
resource "aws_s3_bucket_policy" "scan" {
  bucket = aws_s3_bucket.scan.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.scan.arn, "${aws_s3_bucket.scan.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "OnlyScannerMayWriteVerdict", Effect = "Deny", Principal = "*", Action = ["s3:PutObjectTagging", "s3:PutObjectVersionTagging", "s3:DeleteObjectTagging", "s3:DeleteObjectVersionTagging"], Resource = "${aws_s3_bucket.scan.arn}/scan/*", Condition = { ArnNotEquals = { "aws:PrincipalArn" = aws_iam_role.scanner.arn } } },
    { Sid = "NoCallerSuppliedVerdict", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "${aws_s3_bucket.scan.arn}/scan/*", Condition = { Null = { "s3:RequestObjectTag/GuardDutyMalwareScanStatus" = "false" } } }
  ] })
}
resource "aws_guardduty_malware_protection_plan" "scan" {
  role = aws_iam_role.scanner.arn
  protected_resource {
    s3_bucket {
      bucket_name     = aws_s3_bucket.scan.id
      object_prefixes = ["scan/"]
    }
  }
  actions {
    tagging { status = "ENABLED" }
  }
  depends_on = [aws_iam_role_policy.scanner, aws_s3_bucket_public_access_block.scan, aws_s3_bucket_versioning.scan, aws_s3_bucket_policy.scan]
}
# Attach this policy to a dedicated operator-provisioned principal. No access key
# resource exists here, so Terraform state never receives runtime key material.
resource "aws_iam_policy" "runtime" {
  name = "${local.name}-runtime"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObjectVersion", "s3:GetObjectVersionTagging"], Resource = "${aws_s3_bucket.scan.arn}/scan/*" },
    { Effect = "Allow", Action = ["cognito-idp:AdminGetUser", "cognito-idp:AdminCreateUser"], Resource = "arn:aws:cognito-idp:ap-northeast-1:${var.aws_account_id}:userpool/${module.cognito.user_pool_id}" }
  ] })
}
output "runtime_policy_arn" { value = aws_iam_policy.runtime.arn }
output "public_configuration" {
  value = {
    purpose             = var.environment == "trial" ? "anonymous-trial" : "production"
    offlineOnly         = false
    cloudflareAccountId = var.cloudflare_account_id
    awsAccountId        = var.aws_account_id
    workerName          = local.name
    databaseId          = cloudflare_d1_database.main.id
    restoreDatabaseId   = cloudflare_d1_database.restore.id
    cognitoUserPoolId   = module.cognito.user_pool_id
    cognitoClientId     = module.cognito.client_id
    scanBucket          = aws_s3_bucket.scan.id
    guardDutyPlanId     = aws_guardduty_malware_protection_plan.scan.id
    openAiMode          = "disabled"
  }
}
