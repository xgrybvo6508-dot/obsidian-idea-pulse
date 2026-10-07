import esbuild from "esbuild";
await esbuild.build({entryPoints:["src/main.ts"],bundle:true,outfile:"main.js",format:"cjs",target:"es2020",
external:["obsidian","electron","@codemirror/*"],logLevel:"info"});
