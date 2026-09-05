# Hosting the inspection service

The public demo uses GitHub Pages for the interface and a Render Node web service for URL inspection. The static page does not fetch arbitrary sites itself, and no third-party CORS proxy is involved.

## Render setup

Create a Web Service from this public repository. A public-repository connection does not require access to other GitHub repositories. Use:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --ignore-scripts && npm test` |
| Start command | `ALLOWED_HOSTS="$RENDER_EXTERNAL_HOSTNAME" node server/index.mjs` |
| Health check | `/health` |
| `NODE_VERSION` | `22.23.2` |
| `HOST` | `0.0.0.0` |
| `ALLOWED_ORIGINS` | Your frontend origin, such as `https://yougan001.github.io` |

The app uses Render's `PORT` and explicitly allows its generated hostname. Keep the DNS checks, address pinning, TLS verification and body/time limits intact. Do not add credentials, database access or private services to the demo environment. Read [security.md](security.md) before exposing any self-hosted instance.

For a public-repository connection, verify the service's update behavior instead of assuming that a GitHub push deploys the API. The Render dashboard offers **Manual Deploy → Deploy latest commit**. Check the deployed commit and health before connecting the frontend.

## GitHub Pages setup

Set these repository Actions variables, then run the included Pages workflow:

| Variable | Value |
| --- | --- |
| `VITE_INSPECTION_API` | Full HTTPS endpoint, ending in `/api/inspect` |
| `VITE_INSPECTION_DEMO` | `true` for the free demo's startup notice and 90-second browser wait |

These are public build settings, not secrets. Never put an API credential in a `VITE_` variable. Without an endpoint the page disables URL inspection and keeps its local sample available. The backend operation remains limited to 25 seconds; the longer browser wait allows for hosting startup before the request reaches the app.

## Free demo limits

The current demo runs on Render's Free compute plan in Singapore. It is a demonstration, not an always-on production service. Render can put it to sleep after inactivity; its [free-instance documentation](https://render.com/docs/free) describes startup delays, resource limits and traffic restrictions. No keep-alive job is configured.

The app allows two concurrent inspections, 20 requests per minute per process, and six requests per ten minutes per directly connected IP. Behind Render's proxy, multiple visitors may share that last allowance. The demo deliberately does not trust client-supplied forwarding headers to increase capacity. The interface displays a shared-limit notice; wait when it returns 429, or self-host for sustained use.

The application stores no report history. Submitted URLs and reports still pass through the hosting network, which can have its own logs. Submit only public, unsigned URLs. HTTPS and application validation do not replace network isolation or a production security review.
