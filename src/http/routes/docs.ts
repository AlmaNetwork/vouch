/**
 * API Documentation routes
 * Provides OpenAPI spec and Swagger UI
 */

import { Hono } from "hono";
import type { Env } from "../env.js";
import { openApiSpec } from "../openapi.js";

const route = new Hono<Env>();

/**
 * GET /docs/openapi.json - OpenAPI specification
 */
route.get("/openapi.json", (c) => {
  return c.json(openApiSpec);
});

/**
 * GET /docs - Swagger UI
 */
route.get("/", (c) => {
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vouch Network API - Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>
  `.trim();

  return c.html(html);
});

/**
 * GET /docs/redoc - ReDoc UI (alternative)
 */
route.get("/redoc", (c) => {
  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vouch Network API - Documentation</title>
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <redoc spec-url='/docs/openapi.json'></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
  `.trim();

  return c.html(html);
});

export default route;
