import { createServer } from "vite";

// A separate development server keeps the public fixture out of the authenticated API.
const server = await createServer({
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
  plugins: [{
    name: "pdf-color-fixture",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/api/files/color-fixture/preview")
          req.url = "/scripts/fixtures/pdf-colors.pdf";
        else if (req.url?.startsWith("/pdf-assets/"))
          req.url = req.url.replace("/pdf-assets/", "/node_modules/pdfjs-dist/");
        next();
      });
    },
  }],
});
await server.listen();
console.log("PDF fixture: http://localhost:5188/scripts/pdf-preview.html");
