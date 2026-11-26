from driver_tasks import DriverTasks
from dock import Dock
from commerce import Commerce
from resource_edit import ResourceEdit
from fiscal_readiness import FiscalReadiness
from core import Core
from catalog import Catalog
from operations import Operations
from finance import Finance
from integrations import Integrations
from portal import Portal

class Engine(DriverTasks,Dock,Commerce,ResourceEdit,FiscalReadiness,Portal,Integrations,Finance,Operations,Catalog,Core):
    pass
