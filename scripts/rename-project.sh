#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-project-name>" >&2
  exit 1
fi

NEW_NAME="$1"
OLD_NAME="fullstack-worker-template"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

# package.json / wrangler.jsonc / index.html はテンプレート名が出てくる箇所が
# すべてリネーム対象なので全置換でよい。
sed -i.bak "s/${OLD_NAME}/${NEW_NAME}/g" package.json wrangler.jsonc index.html
rm -f package.json.bak wrangler.jsonc.bak index.html.bak

# deploy.yml は D1 データベース名の行だけを置換する。
# 全置換にすると
#   if: github.event.repository.name != 'fullstack-worker-template'
# のデプロイ抑止ガードまで新プロジェクト名に書き換わり、条件が常に false に
# なって新プロジェクトが永久にデプロイされない。このガードはテンプレート自身の
# リポジトリでだけデプロイを止めるためのもので、リネーム対象ではない
# (terraform.yml / terraform-apply.yml の同じガードも同じ理由で触らない)。
sed -i.bak "/d1 migrations apply/s/${OLD_NAME}/${NEW_NAME}/g" .github/workflows/deploy.yml
rm -f .github/workflows/deploy.yml.bak

# 事後チェック: ガードが原文のまま残っていること。壊れていれば手で戻せるように止める。
if ! grep -q "repository.name != '${OLD_NAME}'" .github/workflows/deploy.yml; then
  echo "ERROR: deploy.yml のデプロイ抑止ガードが失われました。git checkout で戻してください" >&2
  exit 1
fi

# 取りこぼした .bak が無いこと (以前は -maxdepth 2 で
# .github/workflows/deploy.yml.bak を取り逃がし、新プロジェクトに混入していた)。
STRAY_BAK="$(find . -name '*.bak' -not -path './node_modules/*' -not -path './.git/*')"
if [ -n "$STRAY_BAK" ]; then
  echo "ERROR: .bak が残っています:" >&2
  echo "$STRAY_BAK" >&2
  exit 1
fi

echo "Renamed ${OLD_NAME} -> ${NEW_NAME}"
echo ""
echo "Next:"
echo "  1. run 'wrangler d1 create ${NEW_NAME}-db' and put the resulting database_id into wrangler.jsonc"
echo "  2. fix the heading in src/front/pages/HomePage.tsx (and HomePage.test.tsx)"
echo ""
echo "Note: compatibility_date は意図的に更新していません (現在: $(grep -o '"compatibility_date": "[0-9-]*"' wrangler.jsonc))。"
echo "      同梱 workerd が対応する上限より新しい日付にすると、結合テストが"
echo "      ERR_RUNTIME_FAILURE (This Worker requires compatibility date ...) で起動しません。"
echo "      wrangler を上げたときに、その workerd が対応する範囲で更新してください。"
