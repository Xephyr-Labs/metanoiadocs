/// <reference types="vite/client" />

/** This build's id, compared with /version.json by appUpdate.ts. */
declare const __BUILD__: string;

// BlockSuite mounts a custom element imperatively; declare it for JSX-adjacent
// refs even though we create it via document.createElement.
declare namespace JSX {
  interface IntrinsicElements {
    'affine-editor-container': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
