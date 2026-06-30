# Vercel Deployment

This repo is set up as two separate Vercel projects:

- `frontend` for the React/Vite UI
- `backend` for the Express API

## 1. Create the frontend project

1. In Vercel, import the GitHub repo `nethumperera/Senehasa`.
2. Set the project root directory to `frontend`.
3. Keep the default build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add this environment variable:
   - `VITE_API_BASE_URL` = the deployed backend URL, for example `https://senehasa-api.vercel.app`

## 2. Create the backend project

1. In Vercel, create a second project from the same GitHub repo.
2. Set the project root directory to `backend`.
3. Keep the default build settings:
   - Build command: `npm run build` if you add one later, otherwise Vercel can use the default Node handling
   - Output directory: leave empty
4. Add these environment variables:
   - `KAPRUKA_MCP_URL`
   - `NVIDIA_API_KEY` or `OPENROUTER_API_KEY`
   - `NVIDIA_BASE_URL` or `OPENROUTER_BASE_URL`
   - `NVIDIA_MODEL` or `OPENROUTER_MODEL`
   - `MODEL_PROVIDER`
   - `MODEL_MAX_TOKENS`
   - `MODEL_TEMPERATURE`
   - `MODEL_TOP_P`
   - `APP_PUBLIC_URL`
   - `CORS_ORIGIN` = the deployed frontend URL, for example `https://senehasa.vercel.app`

## 3. Connect the two

- The frontend already reads `VITE_API_BASE_URL` in [`frontend/src/App.jsx`](frontend/src/App.jsx).
- The backend exposes the API routes in [`backend/index.js`](backend/index.js).
- Once both projects are deployed, update `VITE_API_BASE_URL` to the backend deployment URL.

## 4. Notes

- GitHub Pages will not work for the backend because it cannot run Node.js/Express.
- Vercel Hobby is enough for this setup.
- If you later add client-side routing, the frontend `vercel.json` already supports SPA fallback.
