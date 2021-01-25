#!/usr/bin/env bash

if [[ $# -ne 3 ]] ; then
    echo "Usage: $0 <electron-version> <node-version> <arch>"
    exit 1
fi

version=$1
electron=electron@$version
npm view $electron | grep \\.tarball
if [[ $? -ne 0 ]] ; then
    echo "Error: electron version $electron does not exist"
    exit 1
fi

nodever=$2
node=node@$nodever
npm view $node | grep \\.tarball
if [[ $? -ne 0 ]] ; then
    echo "Error: node version $node does not exist"
    exit 1
fi

arch=$3

if [[ ! -d ./binary_modules ]] ; then
    # Chances are you are not in the root directory of cortex-debug
    echo "Error: ./binary_modules does not exist"
    exit 1
fi

mkdir -p tmp
cd tmp

function generate () {
    # vers: version of electron
    # arch: x86 or x64
    # os: linux | darwin | win??
    ver=$1 ; arch=$2 ; os=$3

    echo '{}' > package.json
    export npm_config_arch=$arch
    export npm_config_build_from_source=true
    export npm_config_disturl=https://atom.io/download/electron
    export npm_config_runtime=electron
    export npm_config_target=$ver
    export npm_config_target_arch=$arch
    home=$(pwd)/electron-gyp-$ver-$os-$arch
    
    rm -fr node_modules $home
    HOME=$home npm install serialport

    if [[ -d ./node_modules/serialport ]] ; then
        rm -fr node_modules/.bin

        dir=../binary_modules/v$nodever/$os/$arch
        rm -fr $dir
        mkdir -p $dir
        mv node_modules $dir

        echo Listing of dir: $dir/node_modules
        ls $dir/node_modules
    else
        echo "Error: Could not build/create serialport"
        exit 1
    fi
}

os=`uname`
if [[ "$os" == 'Linux' ]] ; then
    generate $version $arch linux
elif [[ "$os" == 'Darwin' ]] ; then
    generate $version $arch darwin
else
    # TODO: yeah, I should check for exact type of env. Just assuming Windows 10 64 bit for now
    echo "Assuming Window 64 bit..."
    generate $version $arch win32
fi
