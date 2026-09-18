resource "aws_cognito_user_pool" "this" {
  name                = var.user_pool_name
  deletion_protection = "INACTIVE"

  # 実際の AWS でもこの値は ForceNew のため明示しておく。
  username_attributes = ["email"]
  mfa_configuration   = "ON"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # 本番前に実 AWS で MFA 必須・招待専用の設定とチャレンジを検証する。
  # moto の応答を MFA の受入証拠には使用しない。
  software_token_mfa_configuration {
    enabled = true
  }
}

resource "aws_cognito_user_pool_client" "this" {
  name                = var.user_pool_client_name
  user_pool_id        = aws_cognito_user_pool.this.id
  generate_secret     = false
  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  enable_token_revocation       = true
  prevent_user_existence_errors = "ENABLED"
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user" "test" {
  count = var.create_test_user ? 1 : 0

  user_pool_id   = aws_cognito_user_pool.this.id
  username       = var.test_user_email
  password       = var.test_user_password
  message_action = "SUPPRESS"

  attributes = {
    email          = var.test_user_email
    email_verified = true
  }
}
