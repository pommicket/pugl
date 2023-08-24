## pugl

online shader thingamabob

### JS features

i have been pretty liberal about using modern javascript;
even though this could in theory run on IE it doesn't
(in particular it is very nice to have template literals).
that said, try to only use features that have at least as much
support as webgl2 (i.e. >94%).

no, i do not want to use a "poly-fill".

we use webgl2 (and consequently GLSL ES 3.00) because:
- having non-constant loops in shaders is nice
- there aren't that many browsers that support webgl and ES6 but not webgl2 (looking at caniuse.com, they probably
  make up around 2% of browser usage)

### widget description

- `.alt` - alternate text for searching. e.g. a widget with name "Foo" and alt "bar" will
  show up in searches for both "foo" and "bar".

### development

before making any commits, run

```sh
npm install
cp -i pre-commit .git/hooks/
```

this ensures that your changes are prettified &amp; linted.
