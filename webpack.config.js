'use strict';

const path = require('path');
const child_process = require('child_process');
const webpack = require('webpack'); //to access built-in plugins
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

const gitStatus = child_process
  .execSync('git status --short')
  .toString()
  .trim();
const commitHash = child_process
  .execSync('git rev-parse --short HEAD')
  .toString()
  .trim() + (gitStatus === '' ? '' : '+dirty');

const commonConfig = {
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js'],
    plugins: [
      new TsconfigPathsPlugin(),
    ],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      __COMMIT_HASH__: JSON.stringify(commitHash)
    })
  ],
};

const extensionConfig = {
  ...commonConfig,
  name: 'extension',
  target: 'node',
  entry: './src/frontend/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  externals: {
    vscode: 'vscode',
    serialport: 'serialport',
    usb: 'usb'
  },
};

const adapterConfig = {
  ...commonConfig,
  name: 'adapter',
  target: 'node',
  entry: './src/gdb.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'debugadapter.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  externals: {
    vscode: 'vscode',
    serialport: 'serialport',
    usb: 'usb',
  },
}

const grapherConfig = {
  ...commonConfig,
  name: 'grapher',
  target: 'web',
  entry: {
    'grapher': './src/grapher/main.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  externals: {
    vscode: 'vscode',
    serialport: 'serialport'
  },
};

const docgenConfig = {
  ...commonConfig,
  target: 'node',
  entry: './src/docgen.ts',
  name: 'docgen',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'docgen.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
}

module.exports = [extensionConfig, adapterConfig, grapherConfig, docgenConfig];
