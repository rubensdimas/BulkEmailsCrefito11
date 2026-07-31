import configRoutes from './configRoutes';
import configController from '../controllers/configController';

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
}

describe('config routes', () => {
  const routes = (configRoutes as unknown as { stack: RouterLayer[] }).stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route?.path,
      methods: Object.keys(layer.route?.methods ?? {}),
      handler: layer.route?.stack[0]?.handle,
    }));

  it('keeps Mailgrid and legacy SMTP configuration paths available', () => {
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/mailgrid', methods: ['get'], handler: configController.getMailgridConfig }),
      expect.objectContaining({ path: '/smtp', methods: ['get'], handler: configController.getMailgridConfig }),
      expect.objectContaining({ path: '/mailgrid', methods: ['post'], handler: configController.updateMailgridConfig }),
      expect.objectContaining({ path: '/smtp', methods: ['post'], handler: configController.updateMailgridConfig }),
      expect.objectContaining({ path: '/mailgrid/test', methods: ['post'], handler: configController.testMailgridConfig }),
      expect.objectContaining({ path: '/smtp/test', methods: ['post'], handler: configController.testMailgridConfig }),
    ]));
  });
});
