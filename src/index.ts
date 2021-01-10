import { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import { DatabaseConnection, DatabaseModels, DatabaseTransaction } from '@fjedi/database-client';
import { DefaultError } from '@fjedi/errors';

export function removeUndefinedValues(values: { [key: string]: any }) {
  const res: { [key: string]: any } = {};
  Object.keys(values).forEach((key) => {
    if (typeof values[key] !== 'undefined') {
      res[key] = values[key];
    }
  });
  return res;
}
//
export type FieldValue = unknown;
export type FieldResolverParams = {
  getDataFromParent?: (rootValue: unknown) => FieldValue;
};

//
export function fieldResolver(
  defaultResolver: GraphQLFieldResolver<any, any>,
  p?: FieldResolverParams,
) {
  return function resolve<TResult, TParent, TContext, TArgs>(
    rootValue: TParent,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ): Promise<TResult> | TResult {
    const { fieldName } = info;
    const { getDataFromParent } = p || {};
    const fieldValue =
      typeof getDataFromParent === 'function'
        ? getDataFromParent(rootValue)
        : // @ts-ignore
          rootValue?.[fieldName];
    //
    if (typeof fieldValue !== 'undefined') {
      return fieldValue;
    }
    //
    return defaultResolver(rootValue, args, context, info);
  };
}

//
export function resolveInstanceById(modelName: keyof DatabaseModels) {
  return async function resolve<TResult, TParent, TContext>(
    _: TParent,
    args: { id: string },
    context: TContext,
    resolveInfo: GraphQLResolveInfo,
  ): Promise<TResult | null> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById },
      },
    } = context;

    const instance = (await dbInstanceById(modelName, args.id, {
      resolveInfo,
      context,
    })) as TResult | null;

    return instance;
  };
}
//
export type UpdateInstanceByIdArgs = { id: string; input: { [k: string]: any } };
export type UpdateInstanceByIdOptions = {
  preprocessInputData?: (
    context: unknown,
    instance: unknown,
    args: UpdateInstanceByIdArgs,
  ) => Promise<UpdateInstanceByIdArgs>;
  beforeTransaction?: (
    context: unknown,
    args: UpdateInstanceByIdArgs,
    instance: unknown,
  ) => Promise<unknown>;
  insideTransaction?: (
    context: unknown,
    args: UpdateInstanceByIdArgs,
    instance: unknown,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>;
};
export function updateInstanceById(
  modelName: keyof DatabaseModels,
  options?: UpdateInstanceByIdOptions,
) {
  return async function resolve<TResult, TParent, TContext>(
    _: TParent,
    args: UpdateInstanceByIdArgs,
    context: TContext,
  ): Promise<TResult> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;

    const instance = (await dbInstanceById(modelName, args.id, {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TResult | null;
    if (
      !instance ||
      // @ts-ignore
      !(instance instanceof context.db.models[modelName])
    ) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }
    //
    const { preprocessInputData, beforeTransaction, insideTransaction } = options || {};
    //
    const { input } =
      typeof preprocessInputData === 'function'
        ? await preprocessInputData(context, instance, args)
        : args;
    //
    const updates = removeUndefinedValues(input);
    //
    if (Object.keys(updates).length === 0) {
      return Promise.resolve(instance);
    }
    //
    if (typeof beforeTransaction === 'function') {
      await beforeTransaction(context, args, instance);
    }
    //
    await wrapInTransaction(async (transaction: DatabaseTransaction) => {
      if (typeof insideTransaction === 'function') {
        await insideTransaction(context, args, instance, transaction);
      }
      // @ts-ignore
      await instance.update(updates, {
        transaction,
      });
    });

    return Promise.resolve(instance);
  };
}
//
export function destroyInstanceById(modelName: keyof DatabaseModels) {
  return async function resolve<TResult, TParent, TContext>(
    _: TParent,
    args: { id: string },
    context: TContext,
  ): Promise<TResult> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;

    const instance = (await dbInstanceById(modelName, args.id, {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TResult | null;
    if (!instance) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }

    await wrapInTransaction(async (transaction: DatabaseTransaction) => {
      // @ts-ignore
      await instance.destroy({
        transaction,
      });
    });

    return instance;
  };
}
