from fiscal_readiness import FiscalReadiness
from core import Core
from catalog import Catalog
from operations import Operations
from finance import Finance
from integrations import Integrations
from portal import Portal

class Engine(FiscalReadiness,Portal,Integrations,Finance,Operations,Catalog,Core):
    pass
