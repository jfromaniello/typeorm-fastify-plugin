import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';

declare module 'fastify' {
  export interface FastifyInstance {
    orm: DataSource & FastifyTypeormInstance.FastifyTypeormNamespace;
  }
  export interface FastifyRequest {
    orm: QueryRunner & {
      [namespace: string]: QueryRunner;
    }
  }
}

// Declaring Multiple DataSources in a Project requires creation of namespace
declare namespace FastifyTypeormInstance {
  interface FastifyTypeormNamespace {
    [namespace: string]: DataSource;
  }
}

/**
 * @typedef {DBConfigOptions}
 * @property {DataSource} connection - A new DataSource passed to plugin
 * @property {string} namespace - Optional namespace to declare multiple DataSources in your project
 */

export type DBConfigOptions = {
  connection?: DataSource;
  namespace?: string;
} & Partial<DataSourceOptions>;

const pluginAsync: FastifyPluginAsync<DBConfigOptions> = async (
  fastify,
  options
) => {
  const {
    namespace,
    connection: connectionInOptions,
    ...typeormOptions
  } = options;

  let connection: DataSource;

  if (connectionInOptions) {
    connection = connectionInOptions;
  } else {
    connection = new DataSource(typeormOptions as DataSourceOptions);
  }

  // If a namespace is passed
  if (typeof namespace === 'string') {
    // If fastify instance does not already have orm initialized
    fastify.decorateRequest('orm', null);

    // Check if namespace is already used
    if (fastify.orm[namespace]) {
      throw new Error(`This namespace has already been declared: ${namespace}`);
    }

    // @ts-ignore
    fastify.orm = fastify.orm || {};
    fastify.orm[namespace] = connection;
    await fastify.orm[namespace].initialize();

    fastify.addHook('onRequest', async (request) => {
      // @ts-ignore
      request.orm = request.orm as {} || {};
      request.orm[namespace] = connection.createQueryRunner();
      await request.orm[namespace].connect();
    });

    const releaseQueryRunner = async (request: FastifyRequest) => {
      // @ts-ignore
      await (request.orm[namespace]).release();
    }

    fastify.addHook('onError', releaseQueryRunner)
    fastify.addHook('onSend', releaseQueryRunner)

    fastify.addHook('onClose', async (fastifyInstance) => {
      await fastifyInstance.orm[namespace].destroy();
    });

    return;
  }

  // Else there isn't a namespace, initialize the connection directly on orm

  await connection.initialize();
  // @ts-ignore
  fastify.orm = connection;

  fastify.decorate('orm', null);
  fastify.addHook('onRequest', async (request) => {
    // @ts-ignore
    request.orm = connection.createQueryRunner();
    request.orm.data = request.orm.data ?? {};
    request.orm.data.request = request;
    await request.orm.connect();
  });

  const releaseQueryRunner = async (request: FastifyRequest) => {
    // @ts-ignore
    await request.orm.release();
  }
  fastify.addHook('onError', releaseQueryRunner)
  fastify.addHook('onSend', releaseQueryRunner)

  fastify.addHook('onClose', async (fastifyInstance) => {
    await fastifyInstance.orm.destroy();
  });

  return Promise.resolve();
};

export default fp(pluginAsync, {
  fastify: '4.x',
  name: '@fastify-typeorm',
});
