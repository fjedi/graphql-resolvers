import { removeUndefinedValues, fieldResolver } from '../src';

const objectWithNullishFields = {
  firstField: 'some-value',
  secondField: 'some-another-value',
  nullishField: null,
  undefinedField: undefined,
};

describe('Test graphql-resolvers helper', function () {
  it('Should filter nullish values from graphql-input', async function () {
    const result = removeUndefinedValues(objectWithNullishFields);

    expect(result).toMatchObject({ firstField: 'some-value', secondField: 'some-another-value' });
  });
});
