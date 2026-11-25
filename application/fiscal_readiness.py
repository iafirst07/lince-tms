"""Fiscal integration preparation. No real certificate, transport or fiscal emission.

Profiles are immutable metadata. Assessments are local checklists, not an assertion
that a government or provider accepted an issuer, document or integration.
"""
from copy import deepcopy
import re
from core import action, require, ident, sha

UFS = set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())
DOCUMENTS = {'CTE', 'MDFE', 'NFE_REFERENCE', 'CIOT'}
ROUTES = {'DIRECT', 'PROVIDER', 'LOCAL_MOCK'}
ENVIRONMENTS = {'LOCAL_TEST', 'HOMOLOGATION', 'PRODUCTION'}
PROFILE_FIELDS = {
    'name', 'issuerRef', 'ufs', 'documents', 'environment', 'route',
    'providerRef', 'certificateRef', 'registrationRef', 'contractRef',
    'schemaRefs', 'scenarioApprovalRef', 'endpointCatalogRef', 'retentionPolicyRef',
}
OPTIONAL_REFS = {
    'issuerRef', 'providerRef', 'certificateRef', 'registrationRef', 'contractRef',
    'scenarioApprovalRef', 'endpointCatalogRef', 'retentionPolicyRef',
}


def metadata_ref(value):
    require(isinstance(value, str) and re.fullmatch(r'[a-z][a-z0-9+.-]{1,23}:[A-Za-z0-9_./:@+-]{1,100}', value), 'FISCAL_METADATA_REFERENCE')
    return value


def validate_profile(data):
    require(isinstance(data, dict) and not set(data) - PROFILE_FIELDS, 'FISCAL_PROFILE_FIELDS')
    values = deepcopy(data)
    ident(values.get('name'))
    require(isinstance(values.get('route'), str) and values['route'] in ROUTES, 'FISCAL_ROUTE')
    require(isinstance(values.get('environment'), str) and values['environment'] in ENVIRONMENTS, 'FISCAL_ENVIRONMENT')
    require((values['route'] == 'LOCAL_MOCK') == (values['environment'] == 'LOCAL_TEST'), 'FISCAL_ROUTE_ENVIRONMENT')
    for field, allowed in [('ufs', UFS), ('documents', DOCUMENTS)]:
        value = values.get(field, [])
        require(isinstance(value, list) and all(isinstance(x, str) and x in allowed for x in value) and len(value) == len(set(value)), 'FISCAL_' + field.upper())
        values[field] = sorted(value)
    for field in OPTIONAL_REFS:
        if values.get(field) is not None:
            metadata_ref(values[field])
    refs = values.get('schemaRefs', {})
    require(isinstance(refs, dict) and set(refs) <= set(values['documents']), 'FISCAL_SCHEMA_REFS')
    for value in refs.values():
        metadata_ref(value)
    values['schemaRefs'] = refs
    values.update(status='IMMUTABLE_CONFIGURATION', realOperationAllowed=False,
                  liveTransmissionEnabled=False, productionReady=False)
    return values


def assess_profile(profile):
    """Produce evidence needs; references remain declared, not externally verified."""
    missing = []
    def needed(field, code, reason):
        if not profile.get(field):
            missing.append({'code': code, 'field': field, 'reason': reason})
    needed('issuerRef', 'ISSUER_UNDEFINED', 'Identificar o estabelecimento emitente e sua responsabilidade.')
    needed('ufs', 'UF_UNDEFINED', 'Definir as UFs do estabelecimento e do cenário aplicável.')
    needed('documents', 'DOCUMENT_SCOPE_UNDEFINED', 'Definir documentos e responsabilidades após avaliação do cenário.')
    needed('scenarioApprovalRef', 'SCENARIO_REVIEW_PENDING', 'Vincular avaliação competente de aplicabilidade; o sistema não conclui dispensa.')
    for document in profile.get('documents', []):
        if not profile.get('schemaRefs', {}).get(document):
            missing.append({'code': 'SCHEMA_CONTRACT_PENDING', 'field': 'schemaRefs.' + document,
                            'reason': 'Registrar versão e vigência do contrato/esquema escolhido.'})
    if profile['route'] != 'LOCAL_MOCK':
        needed('certificateRef', 'CERTIFICATE_CUSTODY_PENDING', 'Referenciar custódia autorizada; não carregar certificado ou senha neste cadastro.')
        needed('registrationRef', 'ISSUER_REGISTRATION_PENDING', 'Referenciar credenciamento/cadastro conforme órgão, UF e cenário.')
        needed('endpointCatalogRef', 'ENDPOINT_CATALOG_PENDING', 'Referenciar catálogo de ambiente/serviços revisado, sem inferir disponibilidade.')
        needed('retentionPolicyRef', 'RETENTION_POLICY_PENDING', 'Definir guarda, acesso e retenção dos documentos e protocolos.')
        if profile['route'] == 'PROVIDER':
            needed('providerRef', 'PROVIDER_UNDEFINED', 'Selecionar fornecedor ou instituição habilitada quando aplicável.')
            needed('contractRef', 'PROVIDER_CONTRACT_PENDING', 'Definir contrato técnico, responsabilidades e retornos do fornecedor.')
    external = [] if profile['route'] == 'LOCAL_MOCK' else [
        {'code': 'LIVE_ADAPTER_NOT_IMPLEMENTED', 'reason': 'Porta preparada; conector específico, assinatura e transmissão real não implementados.'},
        {'code': 'EXTERNAL_ACCEPTANCE_NOT_VERIFIED', 'reason': 'As referências são declaradas; nenhum credenciamento, certificado ou retorno oficial foi verificado.'},
        {'code': 'HOMOLOGATION_PENDING', 'reason': 'Ensaiar mensagens, consultas, rejeições, eventos e recuperação no ambiente autorizado.'},
    ]
    if profile['environment'] == 'PRODUCTION':
        external.append({'code': 'PRODUCTION_RELEASE_PENDING', 'reason': 'A configuração não habilita produção; exige aceite competente e liberação técnica explícita.'})
    return {
        'status': 'PENDING_DATA' if missing else 'LOCAL_CONTRACT_READY',
        'missing': missing, 'externalGates': external,
        'metadataReferencesAreDeclared': True, 'readyForLocalTest': not missing,
        'externalHomologationAccepted': False, 'productionReady': False,
        'realOperationAllowed': False, 'liveTransmissionEnabled': False,
    }


class FiscalAdapterPort:
    """Stable replaceable adapter contract; implementations must provide reconciliation.

    The public preparation contract has no credential or endpoint arguments. A future
    implementation must add authorized credential resolution outside this module.
    """
    contract_version = 'FISCAL_PREPARATION_1'

    def prepare(self, profile, document, operation, business_reference, request_reference):
        require(isinstance(document, str) and document in profile['documents'], 'FISCAL_DOCUMENT_NOT_CONFIGURED')
        require(isinstance(operation, str) and operation in {'ISSUE', 'QUERY', 'CANCEL', 'CLOSE'}, 'FISCAL_OPERATION')
        require(operation != 'CLOSE' or document in {'MDFE', 'CIOT'}, 'FISCAL_CLOSE_NOT_APPLICABLE')
        require(document != 'NFE_REFERENCE' or operation == 'QUERY', 'NFE_IS_EXTERNAL_REFERENCE')
        ident(business_reference); ident(request_reference)
        return {
            'contract': self.contract_version, 'profileId': profile['id'],
            'profileRevision': profile['profileRevision'], 'profileSnapshot': dict(profile),
            'document': document, 'operation': operation, 'businessReference': business_reference,
            'requestReference': request_reference, 'environment': profile['environment'],
            'route': profile['route'], 'format': 'LOCAL_PREPARATION_ENVELOPE_NOT_OFFICIAL_XML',
            'realOperationAllowed': False,
        }

    def submit(self, envelope):
        require(envelope['route'] == 'LOCAL_MOCK', 'FISCAL_EXTERNAL_TRANSMISSION_NOT_IMPLEMENTED', 409)
        return {'status': 'DEMO_PREPARED', 'protocol': 'LOCAL-PREFLIGHT-' + sha(envelope)[:20],
                'contract': self.contract_version, 'officialDocument': False, 'real': False}


class FiscalReadiness:
    @action('admin', 'planner')
    def cmd_fiscal_profile_create(self, db, p, d):
        values = validate_profile(d)
        values.update(profileRevision=1, supersedes=None)
        return self.add(db, p, 'fiscalProfile', values)

    @action('admin', 'planner')
    def cmd_fiscal_profile_revise(self, db, p, d):
        require(not set(d) - {'id', 'version', 'values', 'reason'}, 'FISCAL_REVISION_FIELDS')
        old = self.get(db, p, d.get('id'), 'fiscalProfile', True)
        self.version(old, d); ident(d.get('reason'))
        # A revision is an immutable descendant, not an in-place policy change.
        require(not any(x.get('supersedes') == old['id'] for x in self.all(db, 'fiscalProfile')), 'FISCAL_REVISION_EXISTS', 409)
        values = validate_profile(d.get('values'))
        values.update(profileRevision=old['profileRevision'] + 1, supersedes=old['id'], revisionReason=d['reason'])
        return self.add(db, p, 'fiscalProfile', values)

    @action('admin', 'planner', 'operator')
    def cmd_fiscal_readiness_assess(self, db, p, d):
        require(not set(d) - {'profileId'}, 'FISCAL_ASSESSMENT_FIELDS')
        profile = self.get(db, p, d.get('profileId'), 'fiscalProfile', True)
        result = assess_profile(profile)
        result.update(profileId=profile['id'], profileRevision=profile['profileRevision'], profileSnapshot=dict(profile))
        return self.add(db, p, 'fiscalReadiness', result)

    @action('admin', 'planner', 'operator')
    def cmd_fiscal_local_preflight(self, db, p, d):
        require(not set(d) - {'profileId', 'document', 'operation', 'businessReference', 'requestReference'}, 'FISCAL_PREFLIGHT_FIELDS')
        profile = self.get(db, p, d.get('profileId'), 'fiscalProfile', True)
        assessment = assess_profile(profile)
        require(assessment['readyForLocalTest'], 'FISCAL_PROFILE_INCOMPLETE', 409)
        port = FiscalAdapterPort()
        envelope = port.prepare(profile, d.get('document'), d.get('operation'), d.get('businessReference'), d.get('requestReference'))
        # This command validates a contract only. DIRECT/PROVIDER never invokes submit.
        result = port.submit(envelope) if profile['route'] == 'LOCAL_MOCK' else {
            'status': 'PREPARED_EXTERNAL_BLOCKED', 'officialDocument': False, 'real': False}
        return self.add(db, p, 'fiscalPreflight', {
            'status': result['status'], 'profileId': profile['id'], 'profileRevision': profile['profileRevision'],
            'envelope': envelope, 'result': result, 'externalGates': assessment['externalGates'],
            'productionReady': False, 'realOperationAllowed': False, 'liveTransmissionEnabled': False,
        })
