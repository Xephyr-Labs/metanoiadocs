/// <reference types="vite/client" />

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
