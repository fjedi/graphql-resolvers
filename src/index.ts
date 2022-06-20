import { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import { DatabaseModels, DatabaseTransaction } from '@fjedi/database-client';
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
export type FieldResolverParams<TContext, TParent, TArgs = unknown> = {
  getDataFromParent?: (
    rootValue: TParent,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ) => FieldValue;
};

//
export function fieldResolver<TContext, TParent, TArgs = unknown, TResult = unknown>(
  defaultResolver: GraphQLFieldResolver<TParent, TContext, TArgs>,
  p?: FieldResolverParams<TContext, TParent, TArgs>,
) {
  return function resolve(
    rootValue: TParent,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ): Promise<TResult> | TResult {
    const { fieldName } = info;
    const { getDataFromParent } = p || {};
    const fieldValue =
      typeof getDataFromParent === 'function'
        ? getDataFromParent(rootValue, args, context, info)
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
export type UpdateInstanceByIdArgs = { input: { [k: string]: unknown }; [k: string]: unknown };
export type UpdateInstanceByIdOptions<TContext, TInstance, TArgs> = {
  primaryKey?: string;
  preprocessInputData?: (
    context: TContext,
    instance: TInstance,
    args: TArgs,
  ) => Promise<UpdateInstanceByIdArgs>;
  beforeTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  insideTransaction?: (
    context: TContext,
    args: TArgs,
    instance: TInstance,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>;
};
export function updateInstanceById<
  TContext,
  TInstance,
  TArgs extends UpdateInstanceByIdArgs = UpdateInstanceByIdArgs,
>(
  modelName: keyof DatabaseModels,
  options?: UpdateInstanceByIdOptions<TContext, TInstance, TArgs>,
) {
  return async function resolve(_: unknown, args: TArgs, context: TContext): Promise<TInstance> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;
    //
    const {
      primaryKey = 'id',
      preprocessInputData,
      beforeTransaction,
      insideTransaction,
    } = options || {};

    const instance = (await dbInstanceById(modelName, args[primaryKey], {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TInstance | null;
    if (
      !instance ||
      // @ts-ignore
      !(instance instanceof context.db.models[modelName])
    ) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }
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
export type DestroyInstanceByIdArgs = UpdateInstanceByIdArgs;
export type DestroyInstanceByIdOptions<TContext, TInstance, TArgs> = {
  primaryKey?: string;
  beforeTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  insideTransaction?: (
    context: TContext,
    args: TArgs,
    instance: TInstance,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>;
};
export function destroyInstanceById<
  TContext,
  TInstance,
  TArgs extends DestroyInstanceByIdArgs = DestroyInstanceByIdArgs,
>(
  modelName: keyof DatabaseModels,
  options?: DestroyInstanceByIdOptions<TContext, TInstance, TArgs>,
) {
  return async function resolve(_: unknown, args: TArgs, context: TContext): Promise<TInstance> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;
    //
    const { primaryKey = 'id', beforeTransaction, insideTransaction } = options || {};

    const instance = (await dbInstanceById(modelName, args[primaryKey], {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TInstance | null;
    if (!instance) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }
    //
    if (typeof beforeTransaction === 'function') {
      await beforeTransaction(context, args, instance);
    }

    await wrapInTransaction(async (transaction: DatabaseTransaction) => {
      if (typeof insideTransaction === 'function') {
        await insideTransaction(context, args, instance, transaction);
      }
      // @ts-ignore
      await instance.destroy({
        transaction,
      });
    });

    return instance;
  };
}
