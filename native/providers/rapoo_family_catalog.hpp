#pragma once

namespace pm {

// Receiver/body identity pairs from the A HUB VT_nrf54L catalog, as
// documented by VigilWatt; excluded other driver families and dock roles.
struct RapooFamilyReceiver { unsigned receiver; unsigned body; const wchar_t* label; };
inline constexpr RapooFamilyReceiver rapooFamilyReceivers[]{
    {0x1410, 0x4610, L"Rapoo VT0"},
    {0x1420, 0x4620, L"Rapoo VT0 MAX"},
    {0x144a, 0x464a, L"Rapoo VT0 MAX MASTER"},
    {0x1415, 0x4615, L"Rapoo VT1"},
    {0x1444, 0x4644, L"Rapoo VT1 MAX"},
    {0x1b0a, 0x4b0a, L"Rapoo VT1S MAX V2"},
    {0x146a, 0x466a, L"Rapoo VT1S V2"},
    {0x1422, 0x4622, L"Rapoo VT2"},
    {0x1b12, 0x4b12, L"Rapoo VT2 Air MAX V2"},
    {0x1423, 0x4623, L"Rapoo VT2 MAX"},
    {0x1475, 0x4675, L"Rapoo VT2 MAX MASTER V2"},
    {0x1b09, 0x4b09, L"Rapoo VT2 MAX V2"},
    {0x1468, 0x4668, L"Rapoo VT2 V2"},
    {0x14a4, 0x46a4, L"Rapoo VT2K MAX"},
    {0x1476, 0x4676, L"Rapoo VT2S MAX MASTER V2"},
    {0x1b04, 0x4b04, L"Rapoo VT2S MAX V2"},
    {0x145d, 0x465d, L"Rapoo VT2S V2"},
    {0x1b0c, 0x4b0c, L"Rapoo VT3 Air MAX V2"},
    {0x1417, 0x4617, L"Rapoo VT3 MAX"},
    {0x146d, 0x466d, L"Rapoo VT3 MAX MASTER V2"},
    {0x1b06, 0x4b06, L"Rapoo VT3 MAX V2"},
    {0x14a5, 0x46a5, L"Rapoo VT3 PRO V2"},
    {0x1462, 0x4662, L"Rapoo VT3 V2"},
    {0x1b0d, 0x4b0d, L"Rapoo VT3S Air MAX V2"},
    {0x14a2, 0x46a2, L"Rapoo VT3S Air Max"},
    {0x144b, 0x464b, L"Rapoo VT3S MAX MASTER"},
    {0x146e, 0x466e, L"Rapoo VT3S MAX MASTER V2"},
    {0x1b07, 0x4b07, L"Rapoo VT3S MAX V2"},
    {0x14a6, 0x46a6, L"Rapoo VT3S PRO V2"},
    {0x1464, 0x4664, L"Rapoo VT3S V2"},
    {0x1b14, 0x4b14, L"Rapoo VT4 Air MAX V2"},
    {0x1477, 0x4677, L"Rapoo VT4 MAX MASTER V2"},
    {0x1b03, 0x4b03, L"Rapoo VT4 MAX V2"},
    {0x145b, 0x465b, L"Rapoo VT4 V2"},
    {0x1451, 0x4651, L"Rapoo VT6"},
    {0x1452, 0x4652, L"Rapoo VT6 MAX"},
    {0x1413, 0x4613, L"Rapoo VT7"},
    {0x1b0e, 0x4b0e, L"Rapoo VT7 Air MAX V2"},
    {0x1416, 0x4616, L"Rapoo VT7 MAX"},
    {0x1470, 0x4670, L"Rapoo VT7 MAX MASTER V2"},
    {0x1b05, 0x4b05, L"Rapoo VT7 MAX V2"},
    {0x14a7, 0x46a7, L"Rapoo VT7 PRO V2"},
    {0x1460, 0x4660, L"Rapoo VT7 V2"},
    {0x1b0f, 0x4b0f, L"Rapoo VT7S Air MAX V2"},
    {0x1471, 0x4671, L"Rapoo VT7S MAX MASTER V2"},
    {0x1b02, 0x4b02, L"Rapoo VT7S MAX V2"},
    {0x14a8, 0x46a8, L"Rapoo VT7S PRO V2"},
    {0x1459, 0x4659, L"Rapoo VT7S V2"},
    {0x1b15, 0x4b15, L"Rapoo VT8 Air MAX V2"},
    {0x1478, 0x4678, L"Rapoo VT8 MAX MASTER V2"},
    {0x1b0b, 0x4b0b, L"Rapoo VT8 MAX V2"},
    {0x146c, 0x466c, L"Rapoo VT8 V2"},
    {0x1414, 0x4614, L"Rapoo VT9"},
    {0x1b10, 0x4b10, L"Rapoo VT9 Air MAX V2"},
    {0x1418, 0x4618, L"Rapoo VT9 MAX"},
    {0x1473, 0x4673, L"Rapoo VT9 MAX MASTER V2"},
    {0x1b08, 0x4b08, L"Rapoo VT9 MAX V2"},
    {0x14a9, 0x46a9, L"Rapoo VT9 PRO V2"},
    {0x1466, 0x4666, L"Rapoo VT9 V2"},
    {0x1b11, 0x4b11, L"Rapoo VT9S Air MAX V2"},
    {0x1474, 0x4674, L"Rapoo VT9S MAX MASTER V2"},
    {0x1b01, 0x4b01, L"Rapoo VT9S MAX V2"},
    {0x14aa, 0x46aa, L"Rapoo VT9S PRO V2"},
    {0x1453, 0x4653, L"Rapoo VT9S V2"},
};

constexpr const RapooFamilyReceiver* rapooFamilyReceiver(unsigned pid)
{
    for (const auto& candidate : rapooFamilyReceivers)
        if (candidate.receiver == pid) return &candidate;
    return nullptr;
}

} // namespace pm
