# `src/app-tests/`

Unit tests for the screens in `src/app/`, kept **outside** that directory on
purpose.

`src/app/` is expo-router's routes directory: every `.tsx` file in it becomes a
route, and in a `Tabs` layout an undeclared route still gets a tab. Three test
files once lived there and shipped as phantom tabs that crashed on tap — they
export no component, and their module bodies call `describe`/`it`, which do not
exist outside jest. See stage 15 and issue #43.

`src/app/__tests__/` would **not** help: expo-router's ignore list is
`+html`/`+native-intent` plus `+api`/`+middleware` (`getRoutesCore.js`). There
is no `.test.` rule and no `_`-prefix rule, so a nested directory is routed just
the same.

Jest collects these normally — its patterns are `<rootDir>/src/**/*.test.ts`
and `<rootDir>/src/**/*.test.tsx`, so any location under `src/` works.

`src/app-tests/routes-directory.test.ts` enforces that `src/app/` keeps holding
only real routes.
