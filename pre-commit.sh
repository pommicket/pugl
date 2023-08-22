#!/bin/sh
npx eslint fractiform.js || exit 1
npx prettier -w fractiform.js || exit 1
