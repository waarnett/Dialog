// Files the build bundles as data rather than code (see the loaders in build.mjs).

/** A stylesheet, as text. */
declare module "*.css" {
  const text: string;
  export default text;
}

/** A font, as a data: URL. */
declare module "*.woff2" {
  const url: string;
  export default url;
}
