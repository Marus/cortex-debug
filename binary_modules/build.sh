#!/usr/bin/env bash

if [[ $# -ne 1 ]] ; then
    echo "Usage: $0 <electron-version>"
    exit 1
fi

if [[ ! -f ./package.json ]] ; then
    # Chances are you are not in the root directory of cortex-debug
    echo "Error: ./package.json does not exist"
    exit 1
fi

if ! command -v npm &> /dev/null ; then
    echo "'npm' could not be found. Please install NodeJS. Visit https://nodejs.org/en/download/"
    exit
fi

echo "Installing serialport and electron and rebuilding serialport for Electron version '$1'. This could take a while..."

set -x
npm install
./node_modules/.bin/electron-rebuild -v "$1"
rm -fr electron-"$1"
mkdir -p electron-"$1"
mv ./node_modules electron-"$1"/node_modules

