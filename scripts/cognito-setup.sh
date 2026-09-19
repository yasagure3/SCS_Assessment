#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENDPOINT="http://localhost:5001"

cd "$ROOT_DIR/terraform/envs/local"
terraform init -input=false
terraform apply -input=false -auto-approve

USER_POOL_ID="$(terraform output -raw user_pool_id)"
CLIENT_ID="$(terraform output -raw client_id)"
REGION="${USER_POOL_ID%%_*}"

cd "$ROOT_DIR"

cat >.dev.vars <<EOF
COGNITO_ISSUER=https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}
COGNITO_CLIENT_ID=${CLIENT_ID}
COGNITO_JWKS_URL=${ENDPOINT}/${USER_POOL_ID}/.well-known/jwks.json
EOF

cat >.env.local <<EOF
VITE_COGNITO_USER_POOL_ID=${USER_POOL_ID}
VITE_COGNITO_CLIENT_ID=${CLIENT_ID}
VITE_COGNITO_ENDPOINT=${ENDPOINT}
EOF

echo "moto (local Cognito emulator) bootstrap complete:"
echo "  User Pool ID: ${USER_POOL_ID}"
echo "  Client ID:    ${CLIENT_ID}"
echo "  Local fixture user: test@example.com (see Terraform local-only settings)"
echo "  moto is not proof of MFA or password enforcement. See docs/AUTH_OPERATIONS.md."
echo "Wrote .dev.vars and .env.local"
