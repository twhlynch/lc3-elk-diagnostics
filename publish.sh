# npm install -g @vscode/vsce ovsx
vsce publish --packagePath $1
ovsx publish --packagePath $1
