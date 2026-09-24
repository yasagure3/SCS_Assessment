terraform {
  required_version = ">= 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Deliberately independent from prod's backend. Keep this private and backed up.
  backend "local" {
    path = "../../../.local/preview/terraform.tfstate"
  }
}

variable "aws_account_id" {
  description = "Approved AWS account; provider refuses a different signed-in account."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "Set the approved 12-digit AWS account ID."
  }
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "preview_name" {
  type    = string
  default = "scs-assessment-preview"
  validation {
    condition     = can(regex("^scs-assessment-preview(-[a-z0-9]+(-[a-z0-9]+)*)?$", var.preview_name)) && length(var.preview_name) <= 40
    error_message = "Use the preview Worker name, never a production resource name."
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project     = "scs-assessment"
      Environment = "anonymous-preview"
    }
  }
}

module "cognito" {
  source                = "../../modules/cognito"
  user_pool_name        = "${var.preview_name}-pool"
  user_pool_client_name = "${var.preview_name}-client"
  create_test_user      = false
}

output "user_pool_id" {
  value = module.cognito.user_pool_id
}

output "client_id" {
  value = module.cognito.client_id
}
