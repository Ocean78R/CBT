#!/bin/bash
BASEDIR=$(dirname $0)
node $BASEDIR/dist/index.js
#node ./dist/index.js

read -p "Press enter to close ..."
