// Configuración base de Webpack 5 para el shell y los microfrontends (Module Federation).
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;
const deps = require('./package.json').dependencies;

/**
 * @param {object} o
 * @param {string} o.dir        carpeta de la app
 * @param {string} o.name       nombre del contenedor federado
 * @param {number} o.port       puerto del dev server
 * @param {object} [o.exposes]  módulos que expone (microfrontends)
 * @param {object} [o.remotes]  microfrontends que consume (shell)
 * @param {string} [o.publicPath]
 * @param {object} [o.devServer]
 * @param {Array}  [o.plugins]
 */
module.exports = function makeConfig(o) {
  return (_env, argv) => {
    const prod = argv.mode === 'production';
    return {
      entry: path.join(o.dir, 'src/index.ts'),
      mode: prod ? 'production' : 'development',
      devtool: prod ? 'source-map' : 'eval-cheap-module-source-map',
      output: {
        path: path.join(o.dir, 'dist'),
        publicPath: o.publicPath ?? 'auto',
        filename: prod ? '[name].[contenthash:8].js' : '[name].js',
        clean: true,
      },
      resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        alias: { '@sentinel/shared': path.join(__dirname, 'shared/src/index.ts') },
      },
      module: {
        rules: [
          { test: /\.tsx?$/, loader: 'ts-loader', exclude: /node_modules/, options: { transpileOnly: true, configFile: path.join(o.dir, 'tsconfig.json') } },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        ],
      },
      plugins: [
        new ModuleFederationPlugin({
          name: o.name,
          filename: 'remoteEntry.js',
          exposes: o.exposes ?? {},
          remotes: o.remotes ?? {},
          // React se comparte como singleton: una sola copia en el navegador.
          shared: {
            react: { singleton: true, requiredVersion: deps.react },
            'react-dom': { singleton: true, requiredVersion: deps['react-dom'] },
          },
        }),
        new HtmlWebpackPlugin({ template: path.join(o.dir, 'public/index.html'), favicon: path.join(__dirname, 'shell/public/icons/favicon.png') }),
        ...(o.plugins ? o.plugins(prod) : []),
      ],
      devServer: {
        port: o.port,
        historyApiFallback: true,
        headers: { 'Access-Control-Allow-Origin': '*' },
        ...(o.devServer ?? {}),
      },
      performance: { hints: false },
    };
  };
};
