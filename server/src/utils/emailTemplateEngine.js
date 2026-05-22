const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../emails/templates');
const LAYOUTS_DIR = path.join(__dirname, '../emails/layouts');
const PARTIALS_DIR = path.join(__dirname, '../emails/partials');

const compiledTemplates = new Map();

function registerPartials() {
  if (!fs.existsSync(PARTIALS_DIR)) return;
  
  const files = fs.readdirSync(PARTIALS_DIR);
  files.forEach(file => {
    if (file.endsWith('.hbs')) {
      const name = path.basename(file, '.hbs');
      const content = fs.readFileSync(path.join(PARTIALS_DIR, file), 'utf8');
      handlebars.registerPartial(name, content);
    }
  });
}

function registerHelpers() {
  handlebars.registerHelper('formatDate', function(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  });

  handlebars.registerHelper('formatTime', function(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  });

  handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  handlebars.registerHelper('gt', function(a, b) {
    return a > b;
  });

  handlebars.registerHelper('json', function(context) {
    return JSON.stringify(context, null, 2);
  });

  handlebars.registerHelper('uppercase', function(str) {
    return str ? str.toUpperCase() : '';
  });

  handlebars.registerHelper('lowercase', function(str) {
    return str ? str.toLowerCase() : '';
  });
}

function getTemplate(templateName) {
  if (compiledTemplates.has(templateName)) {
    return compiledTemplates.get(templateName);
  }

  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}`);
  }

  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const template = handlebars.compile(templateContent, {
    strict: true,
    noEscape: false,
    assumePartial: false
  });
  compiledTemplates.set(templateName, template);
  
  return template;
}

function renderTemplate(templateName, data = {}) {
  const template = getTemplate(templateName);
  const defaults = {
    year: new Date().getFullYear(),
    ...data
  };
  return template(defaults);
}

function clearCache() {
  compiledTemplates.clear();
}

registerPartials();
registerHelpers();

module.exports = {
  renderTemplate,
  getTemplate,
  clearCache,
  handlebars
};