import { defineConfig } from 'vite';
import { resolve, basename } from 'path';
import fs from 'fs';

const locales = JSON.parse(fs.readFileSync('./js/locales.json', 'utf-8'));

export default defineConfig({
  base: "/",
  optimizeDeps: {
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        // 默认入口 (英文)
        index: resolve(__dirname, 'index.html'),
        // 中文入口 (动态生成)
        zh_cn: resolve(__dirname, 'zh_cn.html'),
      },
    },
  },
  plugins: [
    {
      name: 'html-i18n-plugin',
      // 在编译 HTML 时触发
      transformIndexHtml(html, ctx) {
        // 判断当前处理的是 index.html(en) 还是 zh_cn.html(zh)
        let _path = (ctx.originalUrl || ctx.path).split('?')[0];
        let locale = basename(_path).replace('.html', '');
        locale = locale == 'index' ? 'en' : locale;
        
        const data = {};
        Object.keys(locales).map(k => {
            data[k] = locales[k][locale] || '';
        });

        // 替换 {{key}} 占位符
        let transformedHtml = html.replace(/{{(.*?)}}/g, (match, key) => {
          return data?.[key.trim()] || match;
        });

        // 注入 JS 变量：将当前语言包注入到 window.__I18N__
        const injectScript = `<script>window.__I18N__ = ${JSON.stringify(data)};</script>`;

        // 动态修改 
        return transformedHtml
                .replace('<script id="i18n-data"></script>', injectScript)
                .replace('lang="en"', `lang="${locale.replace('_','-')}"`);
      },
    },
    {
      name: 'virtual-html-provider',
      // 1. 修复开发环境 (npm run dev)
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // 检查请求路径是否是以 .html 结尾的虚拟路径
          if (req.url.endsWith('.html') && req.url !== '/index.html') {
            // 强制重定向内部请求到 index.html，但保留原始 URL 信息供后续插件识别语言
            req.url = '/index.html';
          }
          next();
        });
      },
      resolveId(id) {
        if (id.endsWith('.html') && !fs.existsSync(id)) {
          return id; // 返回 id 表示我们要接管这个文件的加载
        }
        return null;
      },
      // 拦截非 index.html 的请求，直接读取 index.html 作为模板
      load(id) {
        if (id.endsWith('.html') && !id.endsWith('index.html')) {
          return fs.readFileSync(resolve(__dirname, 'index.html'), 'utf-8');
        }
      }
    }
  ]
});
