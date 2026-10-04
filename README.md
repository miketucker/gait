# Quadruped Gait Atlas

Install dependencies with `npm ci`, then run `npm run dev`. Open
`http://localhost:8124/viewer.html` for the atlas or
`http://localhost:8124/parade.html` for the humanoid parade.

## GitHub Pages

The app needs a Vite build: its source modules use npm imports, JSON imports,
and `import.meta.glob`, which cannot run directly on a static host.

1. In the repository's **Settings → Pages → Build and deployment**, set
   **Source** to **GitHub Actions**.
2. Push the changes to `main`. The **Deploy to GitHub Pages** workflow installs
   dependencies, runs the tests, builds the app, and publishes only `dist/`.
   You can also run it manually from the **Actions** tab.
3. Open `https://miketucker.github.io/gait/parade.html` or
   `https://miketucker.github.io/gait/viewer.html`. The site root opens the atlas.

The build uses relative asset URLs so scripts and shared chunks stay within
the `/gait/` project path. Deploy the contents of `dist/`, rather than the
repository source, if publishing manually.

To check the production build locally, run `npm run build` followed by
`npm run preview`, then open `http://localhost:8125/parade.html`.
