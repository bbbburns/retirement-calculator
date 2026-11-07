// Vite's ?raw imports (used by tests to read static files without Node types).
declare module '*?raw' {
  const content: string;
  export default content;
}
