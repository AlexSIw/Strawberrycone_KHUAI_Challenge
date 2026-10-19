// wrangler.toml [[rules]] bundles *.md files as plain text modules.
declare module '*.md' {
  const text: string;
  export default text;
}
