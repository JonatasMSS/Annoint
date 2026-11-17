module.exports = async (page, waitFor) => {
  await waitFor("!!document.querySelector('[data-action=open-local-project]') && document.querySelector('#app').ariaBusy!=='true' && !document.querySelector('#loading-dialog')?.open");
  await page("document.querySelector('[data-action=open-local-project]').click()");
  await waitFor("!!document.querySelector('.app-shell[data-project-id]') && document.querySelector('#app').ariaBusy!=='true' && !document.querySelector('#loading-dialog')?.open");
};
