/// <reference types="vite/client" />
/// <reference path="./types/global.d.ts" />

declare module '*.glsl' {
  const value: string;
  export default value;
}

declare module '*.frag' {
  const value: string;
  export default value;
}

declare module '*.vert' {
  const value: string;
  export default value;
}
