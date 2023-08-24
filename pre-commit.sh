#!/bin/sh
npx eslint pugl.js || exit 1
npx prettier -w pugl.js || exit 1
git add pugl.js
