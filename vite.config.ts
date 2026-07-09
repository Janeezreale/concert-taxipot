import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CLARITY_ID = "xj48863ssz";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inject-clarity",
      apply: "build",
      transformIndexHtml() {
        return [
          {
            tag: "script",
            attrs: {
              type: "text/javascript",
            },
            children: `
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${CLARITY_ID}");
            `,
            injectTo: "head",
          },
        ];
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
