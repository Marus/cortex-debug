import { SWODecoderConfig } from './common';

export interface SWOAdvancedDecoderConfig extends SWODecoderConfig {
    decoder: string;        // Path to decoder JS file
    config: any;
    ports: number[];        // List of ITM/RTT ports
}

export interface AdvancedDecoder {
    /**
     * @param config: Contains the swo configuration from launch.json. Do not modify this object
     * @param outputData: function to call to output data to the OUTPUT Window
     * @param graphData: Function that emits a message to the grapher. Not sure how this works
     *
     * I am documenting what I know. Please make a PR with edits if you know more. Do not use
     * the parameters outputData or graphData until after init is ready. If you wish to do any debug
     * prints, use console.log(...)
     *
     * Note that typeName() and outputLabel() are used to create a name for the OUTPUT panel. So, you
     * can't use outputData/graphData in those methods either.
     */
    init(
        config: SWOAdvancedDecoderConfig,
        outputData: (output: string, timestamp?: boolean) => void,
        graphData: (data: number, id: string) => void
    ): void;

    typeName(): string;     // Used to create the OUTPUT Panel name
    outputLabel(): string;  // Used to create the OUTPUT Panel name

    /**
     *
     * @param port: the ITM Port
     * @param data: Data just received
     */
    softwareEvent(port: number, data: Buffer): void;

    /**
     * SWV Sync packet received. Probably can be ignored
     */
    synchronized(): void;
    /**
     * SWV Sync lost. Probably can be ignored
     */
    lostSynchronization(): void;

    /**
     * Do any cleanup you want to. Again do not use any functions passed to init from here
     * because they are in the process of being destroyed. Even if it works, we cannot guarantee
     * that in the future
     */
    dispose?(): void;
}
