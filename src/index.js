/* global hexo */

'use strict';

const fs = require('hexo-fs');
const path = require('path');
const Prism = require('node-prismjs');
const dirResolve = require('dir-resolve');

const map = {
    '&#39;': '\'',
    '&amp;': '&',
    '&gt;': '>',
    '&lt;': '<',
    '&quot;': '"'
};

const themeRegex = /^prism-(.*).css$/;
const regex = /<prism data-settings="(.*)?">([\s\S]*?)<\/prism>/igm;
const multiRegex = /<multiprism>([\s\S]*?)<\/multiprism>/igm;

/**
 * Unescape from Marked escape
 * @param {String} str
 * @return {String}
 */
function unescape(str) {
    if (!str || str === null) return '';
    const re = new RegExp('(' + Object.keys(map).join('|') + ')', 'g');
    return String(str).replace(re, match => map[match]);
}

/**
 * Wrap theme file to unified format
 * @param {String} basePath
 * @param {String} filename
 * @return {Object}
 */
function toThemeMap(basePath, filename) {
    const matches = filename.match(themeRegex);
    if (!matches) {
        return undefined;
    }

    return {
        name: matches[1],
        filename,
        path: path.join(basePath, filename)
    };
}

const rootPath = hexo.config.root || '/';
const prismLineNumbersPluginDir = dirResolve('prismjs/plugins/line-numbers');
const prismThemeDir = dirResolve('prismjs/themes');
const extraThemeDir = dirResolve('prism-themes/themes');
const prismMainFile = require.resolve('prismjs');
const standardThemes = fs.listDirSync(prismThemeDir)
    .map(themeFileName => toThemeMap(prismThemeDir, themeFileName));
const extraThemes = fs.listDirSync(extraThemeDir)
    .map(themeFileName => toThemeMap(extraThemeDir, themeFileName));

// Since the regex will not match for the default "prism.css" theme,
// we filter the null theme out and manually add the default theme to the array
const themes = standardThemes.concat(extraThemes).filter(Boolean);
themes.push({
    name: 'default',
    filename: 'prism.css',
    path: path.join(prismThemeDir, 'prism.css')
});

// If prism plugin has not been configured, it cannot be initialized properly.
if (!hexo.config.prism_plugin) {
    throw new Error('`prism_plugin` options should be added to _config.yml file');
}

// Plugin settings from config
const prismThemeName = hexo.config.prism_plugin.theme || 'default';
const mode = hexo.config.prism_plugin.mode || 'preprocess';
let line_number = hexo.config.prism_plugin.line_number || false;
const custom_css = hexo.config.prism_plugin.custom_css || null;

const prismTheme = themes.find(theme => theme.name === prismThemeName);
if (!prismTheme) {
    throw new Error(`Invalid theme ${prismThemeName}. Valid Themes: \n${themes.map(t => t.name).concat('\n')}`);
}
const prismThemeFileName = prismTheme.filename;
const prismThemeFilePath = custom_css === null ? prismTheme.path : path.join(hexo.base_dir, custom_css);

function refraction(origin, config, code) {
    if (!config.lang) {
        return `<pre><code>${code}</code></pre>`;
    }

    if (config.line_number !== undefined) {
        line_number = config.line_number;
    }
    const startTag = `<code class="language-${config.lang}">`;
    const endTag = '</code>';
    code = unescape(code.replace(/&#123;/g, '{')
        .replace(/&#125;/g, '}'));
    let parsedCode = '';
    if (Prism.languages[config.lang]) {
        parsedCode = Prism.highlight(code, Prism.languages[config.lang]);
    } else {
        parsedCode = code;
    }
    if (line_number) {
        const match = parsedCode.match(/\n(?!$)/g);
        const linesNum = match ? match.length + 1 : 1;
        let lines = new Array(linesNum + 1);
        lines = lines.join('<span></span>');
        const countFrom = config.first_line ? ` style="counter-reset: linenumber ${config.first_line - 1};"` : '';
        const startLine = `<span aria-hidden="true" class="line-numbers-rows"${countFrom}>`;
        const endLine = '</span>';
        parsedCode += startLine + lines + endLine;
    }
    return startTag + parsedCode + endTag;
}

function wrapping(origin, config, content) {
    if (!config.lang) {
        return refraction(origin, config, content);
    }

    const lineNumbers = line_number ? 'line-numbers' : '';
    const caption = config.caption ? `<figcaption>${config.caption}</figcaption>` : '';
    const startTag = config.multi ? caption : `<pre class="${lineNumbers} language-${config.lang}">${caption}`;
    const endTag = config.multi ? '' : '</pre>';
    return startTag + refraction(origin, config, content) + endTag;
}

function reprism(content) {
    return content.replace(regex, (origin, settings, c) => {
        const config = JSON.parse(unescape(settings.replace(/&#123;/g, '{')
            .replace(/&#125;/g, '}')).replace(/&#x2F;/g, '/'));
        return wrapping(origin, config, c);
    });
}

function multiwrapping(content) {
    let flag = false;
    const lineNumbers = line_number ? 'line-numbers' : '';
    let ln = '';
    return content.replace(multiRegex, (o, src) => {
        const res = src.replace(regex, (origin, settings, c) => {
            const config = JSON.parse(unescape(settings.replace(/&#123;/g, '{')
                .replace(/&#125;/g, '}')).replace(/&#x2F;/g, '/'));
            config.multi = true;
            if (!flag) {
                flag = true;
                ln = config.lang;
            }
            return wrapping(origin, config, c);
        });
        const startTag = `<pre class="${lineNumbers} language-${ln}">`;
        const endTag = '</pre>';

        return startTag + res + endTag;
    });
}

/**
 * Code transform for prism plugin.
 * @param {Object} data
 * @return {Object}
 */
function PrismPlugin(data) {
    data.content = multiwrapping(data.content);
    data.content = reprism(data.content);
    return data;
}

/**
 * Copy asset to hexo public folder.
 */
function copyAssets() {
    const assets = [{
        path: `css/${prismThemeFileName}`,
        data: () => fs.createReadStream(prismThemeFilePath)
    }];

    // If line_number is enabled in plugin config add the corresponding stylesheet
    if (line_number) {
        assets.push({
            path: 'css/prism-line-numbers.css',
            data: () => fs.createReadStream(path.join(prismLineNumbersPluginDir, 'prism-line-numbers.css'))
        });
    }

    // If prism plugin config mode is realtime include prism.js and line-numbers.js
    if (mode === 'realtime') {
        assets.push({
            path: 'js/prism.js',
            data: () => fs.createReadStream(prismMainFile)
        });
        if (line_number) {
            assets.push({
                path: 'js/prism-line-numbers.min.js',
                data: () => fs.createReadStream(path.join(prismLineNumbersPluginDir, 'prism-line-numbers.min.js'))
            });
        }
    }
    return assets;
}

/**
 * Injects code to html for importing assets.
 * @param {String} code
 * @param {Object} data
 */
function importAssets(code) {
    const js = [];
    const css = [
        `<link rel="stylesheet" href="${rootPath}css/${prismThemeFileName}" type="text/css">`
    ];

    if (line_number && custom_css === null) {
        css.push(`<link rel="stylesheet" href="${rootPath}css/prism-line-numbers.css" type="text/css">`);
    }
    if (mode === 'realtime') {
        js.push(`<script src="${rootPath}js/prism.js"></script>`);
        if (line_number) {
            js.push(`<script src="${rootPath}js/prism-line-numbers.min.js"></script>`);
        }
    }
    const imports = css.join('\n') + js.join('\n');

    // Avoid duplicates
    if (code.indexOf(imports) > -1) {
        return code;
    }
    return code.replace(/<\s*\/\s*head\s*>/, imports + '</head>');
}

// Register prism plugin
hexo.extend.filter.register('after_post_render', PrismPlugin);

if (custom_css === null) {
    // Register to append static assets
    hexo.extend.generator.register('prism_assets', copyAssets);

    // Register for importing static assets
    hexo.extend.filter.register('after_render:html', importAssets);
}
