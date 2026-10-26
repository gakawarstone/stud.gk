export const call = (object, method, ...args) =>
  new Promise((resolve, reject) =>
    object[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
