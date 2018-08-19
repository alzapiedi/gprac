const config = require('./config.json');
const PATH = process.argv[1].split('/').slice(0, 3).join('/');

const cheerio = require('cheerio');
const cookie = require('cookie');
const fs = require('fs');
const superagent = require('superagent');
const exec = require('child_process').execSync;

const agent = superagent.agent();

function getStoredData() {
  if (!fs.existsSync(PATH + '/.gprac_data')) return;
  try {
    const data = JSON.parse(fs.readFileSync(PATH + '/.gprac_data'));
    return data;
  } catch (err) {
    return;
  }
}

function getStoredSession() {
  if (!fs.existsSync(PATH + '/.ghc')) return;
  try {
    const storedSession = JSON.parse(fs.readFileSync(PATH + '/.ghc'));
    if (!storedSession.user_session || !storedSession.expires || +new Date() > +new Date(storedSession.expires)) return;
    return storedSession;
  } catch (err) {
    return;
  }
}

function saveData(data) {
  fs.writeFileSync(PATH + '/.gprac_data', JSON.stringify(data));
}

function login(storedSession) {
  return new Promise((resolve, reject) => {
    if (storedSession) {
      const c = `user_session=${storedSession.user_session}`;
      agent._saveCookies({ headers: { 'set-cookie': c } });
      return resolve({ fromStored: true, ...storedSession });
    }

    agent.get('https://github.com/login')
      .then(res => {
        const $ = cheerio.load(res.text);
        const authenticity_token = encodeURIComponent($('input[name="authenticity_token"]').val());

        return agent.post('https://github.com/session').send(`commit=Sign+in&utf8=%E2%9C%93&authenticity_token=${authenticity_token}&login=${config.login}&password=${config.password}`)
      })
      .then(res => {
        const $ = cheerio.load(res.text);
        const authenticity_token = encodeURIComponent($('input[name="authenticity_token"]').val());
        const otp = exec(config.get_auth_code).toString().trim();

        return agent.post('https://github.com/sessions/two-factor').send(`utf8=%E2%9C%93&authenticity_token=${authenticity_token}&otp=${otp}`)
      })
      .then((res => {
        const session = cookie.parse(res.headers['set-cookie'].find(c => c.indexOf('user_session=') === 0));
        fs.writeFileSync(PATH + '/.ghc', JSON.stringify(session));
        resolve({ fromStored: false, ...session });
      }))
      .catch(reject);
  })
}

function fail(message) {
  if (message) console.log(message);
  process.exit(1);
}

function getBranchByPR(num) {
  return agent.get(`https://github.com/instructure/px-web-app/pull/${num}`).then(res => {
    const $ = cheerio.load(res.text);
    const branch = $('span.commit-ref span.css-truncate-target').eq(1).text();
    return branch;
  });
}

function getBranchByJira(num) {
  return getPRByJira(num).then(getBranchByPR).then(branch => {
    return branch;
  });
}

function getPRByJira(num) {
  return agent.get('https://github.com/instructure/px-web-app/pulls').then(res => {
    const $ = cheerio.load(res.text);
    const entries = $('.issues-listing ul li a').filter((i, el) => {
      return $(el).text().indexOf(`PRAC-${num}`) > 0;
    });
    const href = entries.attr('href');
    const pr = href.split('/')[4];

    return pr;
  });
}

function gitCheckout(branch) {
  try {
    exec(`git checkout ${branch}`);
  } catch (e) {
    return;
  }
}

function githubPR(num) {
  try {
    exec(`open https://github.com/instructure/px-web-app/pull/${num}`);
  } catch (e) {
    return;
  }
}

function merge(from = {}, to = {}) {
  const keys = Object.keys(from);
  keys.forEach(key => to[key] = from[key]);
  return to;
}

module.exports = {
  fail,
  getStoredData,
  getStoredSession,
  getBranchByPR,
  getBranchByJira,
  getPRByJira,
  gitCheckout,
  githubPR,
  login,
  merge,
  saveData
};
