// End-to-end checks of the main user flow: load an example, see charts, switch renderer,
// and inspect the data table. Run with `npm run test:e2e` (starts the server for you).

const CHART_IDS = ['chart-a', 'chart-b', 'chart-scatter'];

/** Clicks the "Steps & sleep" example and waits until the worker has finished loading it. */
function loadStepsExample() {
  cy.get('button[data-a="data/DATA - Step Count.csv"]').click();
  cy.get('#status', { timeout: 20000 }).should('contain.text', 'Ready');
}

describe('Steps & Sleep site', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('shows the upload prompt and hides charts before any data loads', () => {
    cy.get('h1').should('have.text', 'Steps & Sleep');
    cy.get('#status').should('contain.text', 'Upload two CSV files');
    cy.get('#charts').should('not.be.visible');
  });

  it('draws all three charts on canvas after loading an example', () => {
    loadStepsExample();
    cy.get('#status').should('contain.text', '5 groups').and('contain.text', '35 matched pairs');
    cy.get('#charts').should('be.visible');
    CHART_IDS.forEach((id) => cy.get(`#${id} canvas`).should('have.length', 1));
  });

  it('redraws the charts as SVG when the SVG renderer is chosen', () => {
    loadStepsExample();
    cy.get('#renderer-svg').click();
    cy.get('#renderer-svg').should('have.attr', 'aria-pressed', 'true');
    CHART_IDS.forEach((id) => {
      cy.get(`#${id} canvas`).should('not.exist');
      cy.get(`#${id} svg`).should('exist');
    });
  });

  it('lists every row in the data table and empties it for a filter with no match', () => {
    loadStepsExample();
    cy.get('#table-details summary').click();
    cy.get('#data-table tbody tr').should('have.length', 35);
    cy.get('#export').should('not.be.disabled');

    cy.get('#group-filter').type('no-such-group');
    cy.get('#table-empty').should('be.visible');
    cy.get('#data-table tbody tr').should('have.length', 0);
  });
});
