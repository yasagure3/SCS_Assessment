import { Link } from "react-router";

export function RouteError() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
      <p className="text-sm font-semibold tracking-widest text-blue-700">SCS ASSESSMENT</p>
      <h1 className="text-2xl font-bold">画面を表示できませんでした</h1>
      <p>入力中の内容を確認し、もう一度ページを開いてください。</p>
      <Link className="text-blue-700 underline" to="/">
        トップへ戻る
      </Link>
    </main>
  );
}
