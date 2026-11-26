"""Opt-in fictional tariff policy; exact rational volume, no provider inference."""
from fractions import Fraction
from decimal import Decimal
from core import require, dec

POLICY='VOLUMETRIC_MAX_TOTAL_KG_V1'
FIELDS={'id','dimensionUnit','divisorCm3PerKg','rounding','aggregation','minimumBillableKg'}

def validate_policy(policy):
    require(isinstance(policy,dict) and set(policy)==FIELDS,'INVALID_VOLUMETRIC_POLICY')
    require(policy['id']==POLICY and policy['dimensionUnit']=='CM' and policy['rounding']=='CEILING_0_001_KG' and policy['aggregation']=='MAX_OF_TOTAL_REAL_AND_TOTAL_VOLUMETRIC' and policy['minimumBillableKg']=='0.000','INVALID_VOLUMETRIC_POLICY')
    dec(policy['divisorCm3PerKg'],Decimal('.000001'))
    return policy

def calculation(packs,policy):
    validate_policy(policy)
    real=sum(Fraction(x['weightKg']) for x in packs)
    volume=sum(Fraction(x['lengthCm'])*Fraction(x['widthCm'])*Fraction(x['heightCm']) for x in packs)
    divisor=Fraction(policy['divisorCm3PerKg']);cubed=volume/divisor
    def ceil_milli(value):return (value.numerator*1000+value.denominator-1)//value.denominator
    def fmt(milli):return str(milli//1000)+'.'+str(milli%1000).zfill(3)
    def exact(value):
        # Inputs have at most six places, cube at most eighteen.
        scaled=value*10**18;require(scaled.denominator==1,'INVALID_VOLUME_PRECISION')
        return (str(scaled.numerator//10**18)+'.'+str(scaled.numerator%10**18).zfill(18)).rstrip('0').rstrip('.')
    return {'realKg':exact(real),'volumeCm3':exact(volume),'divisorCm3PerKg':policy['divisorCm3PerKg'],
        'volumetricKgRaw':{'numerator':str(cubed.numerator),'denominator':str(cubed.denominator)},
        'volumetricKg':fmt(ceil_milli(cubed)),'billableKg':fmt(ceil_milli(max(real,cubed))), 'policySnapshot':dict(policy)}
