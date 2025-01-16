import { EventEmitter } from 'stream';
import { SWORTTSource } from './common';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as usb from 'usb';

/*
 * NOTE: using legacy node-usb interface, because the modern
 * WebUSB-compatible version doesn't contain a way to interrupt pending
 * transfer, leading to problems with getting rid of the connection
 */

export class UsbSWOSource extends EventEmitter implements SWORTTSource {
  private dev?: usb.Device;
  private iface?: usb.Interface;
  private ep?: usb.InEndpoint;

  constructor(
    private readonly device: string,
    private readonly port: string
  ) {
    super();

    this.start();
  }

  private async findDevice(): Promise<
    | {
        dev: usb.Device;
        config: usb.ConfigDescriptor;
        iface: usb.InterfaceDescriptor;
        endpoint: usb.EndpointDescriptor;
        productName: string;
      }
    | undefined
  > {
    console.info('Looking for USB devices matching', this.device);
    const devs = usb.getDeviceList();
    for (const dev of devs) {
      dev.open();
      const { deviceDescriptor: dd } = dev;
      const getStringDescriptor: (index: number) => Promise<string | undefined> =
        promisify(dev.getStringDescriptor).bind(dev);
      const productName = await getStringDescriptor(dd.iProduct);
      if (productName.match(this.device)) {
        console.info(
          'Found device',
          productName,
          'VID',
          dd.idVendor.toString(16),
          'PID',
          dd.idProduct.toString(16),
          'Serial',
          await getStringDescriptor(dd.iSerialNumber)
        );

        for (const cfg of dev.allConfigDescriptors) {
          for (const iface of cfg.interfaces) {
            for (const alt of iface) {
              const interfaceName = await getStringDescriptor(alt.iInterface);
              if (interfaceName?.match(this.port)) {
                for (const ep of alt.endpoints) {
                  if ((ep.bmAttributes & 3) === usb.usb.LIBUSB_TRANSFER_TYPE_BULK &&
                       ep.bEndpointAddress & usb.usb.LIBUSB_ENDPOINT_IN) {
                    console.info(
                      'Matched config',
                      cfg.bConfigurationValue,
                      'interface',
                      alt.bInterfaceNumber,
                      'alternate',
                      alt.bAlternateSetting,
                      'endpoint',
                      ep.bEndpointAddress
                    );
                    return {
                      dev,
                      config: cfg,
                      iface: alt,
                      endpoint: ep,
                      productName
                    };
                  }
                }
              }
            }
          }
        }

        console.warn('Couldn\'t match interface named', this.port);
      }
      dev.close();
    }
    console.warn('Matching device not found');
    return undefined;
  }

  public async start() {
    const { dev, config, iface, endpoint, productName } = (await this.findDevice()) ?? {};
    if (!dev) {
      vscode.window.showErrorMessage(
        `Couldn't find a device matching '${this.device}' with interface '${this.port}`
      );
      return;
    }

    console.debug('Connecting to', productName);
    await dev.open();
    this.dev = dev;
    console.debug('Selecting configuration', config.bConfigurationValue);
    await promisify(dev.setConfiguration).bind(dev)(config.bConfigurationValue);
    console.debug('Claiming interface', iface.bInterfaceNumber);
    this.iface = dev.interface(iface.bInterfaceNumber);
    this.iface.claim();
    if (iface.bAlternateSetting) {
      console.debug('Selecting alternate', iface.bAlternateSetting);
      await dev.interface(iface.iInterface).setAltSettingAsync(iface.bAlternateSetting);
    }
    console.debug('Reading from endpoint', endpoint.bEndpointAddress);

    this.ep = this.iface.endpoint(endpoint.bEndpointAddress) as usb.InEndpoint;
    this.ep.on('data', (buffer: Buffer) => {
      console.debug(buffer.length, 'bytes received');
      this.emit('data', buffer);
    });
    this.ep.on('error', (error) => {
      console.error('Unexpected polling error', error);
    });
    this.ep.startPoll();

    this.emit('connected');
  }

  public get connected() {
    return !!this.ep;
  }
  
  public async dispose() {
    if (this.ep) {
      console.debug('Stopping polling...');
      await promisify(this.ep.stopPoll).bind(this.ep)();
      this.ep = undefined;
      console.debug('Polling stopped');
    }
    if (this.iface) {
      console.debug('Releasing interface...');
      await this.iface.releaseAsync();
      this.iface = undefined;
      console.debug('Interface released');
    }
    if (this.dev) {
      console.debug('Closing device...');
      this.dev.close();
      this.dev = undefined;
      console.debug('Device closed');
    }
    this.emit('disconnected');
  }
}
