'use strict';

const path = require('path');
const child_process = require('child_process');
const webpack = require('webpack'); //to access built-in plugins

const gitStatus = child_process
  .execSync('git status --short')
  .toString()
  .trim();
const commitHash = child_process
  .execSync('git rev-parse --short HEAD')
  .toString()
  .trim() + (gitStatus === '' ? '' : '+dirty');

const extensionConfig = {
  target: 'node',
  entry: './src/frontend/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'vscode',
    serialport: 'serialport'
  },
  resolve: {
    extensions: ['.ts', '.js']
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
  }
};

const adapterConfig = {
  target: 'node',
  entry: './src/gdb.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'debugadapter.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'vscode',
    serialport: 'serialport'
  },
  resolve: {
    extensions: ['.ts', '.js']
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
  ]
}

const grapherConfig = {
  target: 'web',
  entry: {
    'grapher': './src/grapher/main.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'vscode',
    serialport: 'serialport'
  },
  resolve: {
    extensions: ['.ts', '.js']
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
  }
};

const docgenConfig = {
  target: 'node',
  entry: './src/docgen.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'docgen.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js']
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
  ]  
}

module.exports = [extensionConfig, adapterConfig, grapherConfig, docgenConfig];
