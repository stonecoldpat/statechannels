const cTable = require("console.table");

// TODO: clean up and refactor this file - it could be a nice util

let createMethodGasProxy = (prop, obj, gasLib) => {
    let handlerMethod = {
        apply: (target, that, args) => {
            let result = target.apply(that, args);

            if (typeof result === "object" && "then" in result) {
                return result.then(success => {
                    if (typeof success === "object" && "receipt" in success && "gasUsed" in success["receipt"]) {
                        gasLib.push({ method: prop, gasUsed: success.receipt.gasUsed });
                    }
                    return success;
                });
            } else return result;
        }
    };

    return new Proxy(obj, handlerMethod);
};

// accepts objects of the form:
// { method: string, gasUsed: number, parameters: object[] }

let createContractGasProxy = (contract, gasLib, web3) => {
    let handlerMain = {
        get: (obj, prop) => {
            if (prop in obj) {
                let g = obj[prop];

                if (typeof g === "function" && "call" in g && "sendTransaction" in g) {
                    return createMethodGasProxy(prop, g, gasLib, web3);
                } else {
                    return g;
                }
            } else return undefined;
        }
    };

    return new Proxy(contract, handlerMain);
};

let createGasProxy = (contractType, gasLib, web3) => {
    const recordGasAndCreateContractProxy = (prop, val) => {
        let contractHandler = {
            apply: (target, that, args) => {
                let result = target.apply(that, args);
                if (typeof result === "object" && "then" in result) {
                    return result.then(success => {
                        // new doesnt have a receipt, so get one and record the gas
                        return web3.eth.getTransactionReceipt(success.transactionHash).then(receipt => {
                            gasLib.push({ method: prop, gasUsed: receipt.gasUsed });
                            // the result of calling new is contract, for which we want a gas proxy
                            return createContractGasProxy(success, gasLib, web3);
                        });
                    });
                }
            }
        };

        return new Proxy(val, contractHandler);
    };

    let handlerMain = {
        get: (obj, prop) => {
            if (prop in obj) {
                let g = obj[prop];
                if (prop === "new" && typeof g === "function") {
                    // proxy the "new" function
                    return recordGasAndCreateContractProxy(prop, g);
                } else return g;
            }
        }
    };

    return new Proxy(contractType, handlerMain);
};

const logGasLib = gasLib => {
    let reducer = (accumulator, currentValue) => {
        let records = accumulator.filter(a => a.method === currentValue.method);
        if (records && records[0]) {
            // update
            const record = records[0];
            record.totalGas += currentValue.gasUsed;
            record.timesCalled += 1;
            return accumulator;
        } else {
            const aggr = {
                method: currentValue.method,
                totalGas: currentValue.gasUsed,
                timesCalled: 1,
                averageGas: () => {
                    return aggr.totalGas / aggr.timesCalled;
                }
            };

            // push
            accumulator.push(aggr);
            return accumulator;
        }
    };
    let aggregates = gasLib.reduce(reducer, []);
    let total = {
        method: "TOTAL",
        totalGas: aggregates.map(s => s.totalGas).reduce((accum, curr) => accum + curr),
        timesCalled: aggregates.map(s => s.timesCalled).reduce((accum, curr) => accum + curr),
        averageGas: () => {
            return total.totalGas / total.timesCalled;
        }
    };
    aggregates.push(total);

    // execute aggregate functions
    const bufferedAggregates = aggregates.map(a => {
        let ba = {};
        for (const key in a) {
            if (a.hasOwnProperty(key)) {
                const element = a[key];
                if (typeof element === "function") {
                    ba[key] = element();
                } else {
                    ba[key] = element;
                }
            }
        }
        return ba;
    });

    console.table(bufferedAggregates);
};

module.exports = {
    createGasProxy,
    logGasLib
};
