// Vite の `?url` サフィックス付きアセット import 用のアンビエント宣言。
// charts/*.mid / charts/*.sf2 は vite.config.ts の assetsInclude でアセット扱いになり、
// `?url` を付けると解決済み URL 文字列が default export される。

declare module '*.mid?url' {
  const url: string;
  export default url;
}

declare module '*.sf2?url' {
  const url: string;
  export default url;
}
