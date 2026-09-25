terraform {
  required_version = ">= 1.15"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 6.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
  backend "local" { path = "../../../.local/production/terraform.tfstate" }
}
variable "aws_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Use the approved AWS account ID."
  }
}
variable "cloudflare_account_id" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_account_id))
    error_message = "Use the approved Cloudflare account ID."
  }
}
variable "suffix" {
  type    = string
  default = "integration"
  validation {
    condition     = can(regex("^[a-z0-9]{1,12}$", var.suffix))
    error_message = "Use a short anonymous environment suffix."
  }
}
variable "production_creation_confirmed" {
  type    = bool
  default = false
  validation {
    condition     = var.production_creation_confirmed
    error_message = "Production requires a separate recorded release decision; anonymous-trial approval is insufficient."
  }
}
variable "backup_expiry_confirmed" {
  type    = bool
  default = false
}
provider "aws" {
  region              = "ap-northeast-1"
  allowed_account_ids = [var.aws_account_id]
  default_tags { tags = { Project = "scs-assessment", Environment = "production" } }
}
provider "cloudflare" {}
module "cloud" {
  source                  = "../../modules/cloud"
  environment             = "prod"
  suffix                  = var.suffix
  aws_account_id          = var.aws_account_id
  cloudflare_account_id   = var.cloudflare_account_id
  backup_expiry_confirmed = var.backup_expiry_confirmed
}
output "public_configuration" { value = module.cloud.public_configuration }
output "runtime_policy_arn" { value = module.cloud.runtime_policy_arn }

