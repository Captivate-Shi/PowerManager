#include "verified_mouse.hpp"
#include <cassert>
using namespace pm;
using namespace pm::verified_mouse;
int main()
{
    static_assert(kind(0x3434,0xd048)==Kind::keychronM5);
    static_assert(!kind(0x3434,0xd028));
    static_assert(kind(0x03f0,0x0f98)==Kind::haste2);
    static_assert(!kind(0x03f0,0x0da0));
    static_assert(!kind(0x03f0,0x0d97));
    static_assert(kind(0x3554,0xf58a)==Kind::vxeReceiver);
    static_assert(kind(0x3554,0xf58c)==Kind::vxeCable);
    static_assert(!kind(0x3554,0xf58e));
    static_assert(collection(Kind::keychronM5,4,0xff01,1,64,64));
    static_assert(!collection(Kind::keychronM5,1,0xff01,1,64,64));
    static_assert(collection(Kind::haste2,2,0xff00,1,64,64));
    static_assert(!collection(Kind::haste2,2,0xff00,2,64,64));
    static_assert(collection(Kind::vxeReceiver,1,0xff02,2,17,17));
    static_assert(!collection(Kind::vxeReceiver,1,0xff02,2,16,17));
    static_assert(collection(Kind::vxeReceiver,1,0xff02,2,20,32));
    static_assert(!collection(Kind::vxeReceiver,1,0xff02,2,20,33));
    auto a=keychronQuery();
    assert(!keychronReply(a));
    a[0]=0xb4; a[20]=0xb7; // 55%, charge
    const auto m=keychronReply(a);
    assert(m && m->reading->low==55 && m->reading->power==Power::charging);
    assert(!keychronReply(std::span(a).first(63)));
    a[20]=101; assert(!keychronReply(a));
    a[20]=0; assert(!keychronReply(a));
    auto b=hasteQuery(true);
    assert(!hasteLink(b));
    b[0]=0x53; assert(hasteLink(b)==false);
    b[2]=1; assert(hasteLink(b)==true);
    b[2]=2; assert(!hasteLink(b));
    b=hasteQuery(false);
    assert(!hasteReply(b)); b[0]=0x51; assert(!hasteReply(b));
    b[2]=83; b[3]=2; assert(hasteReply(b)->reading->power==Power::unknown);
    b[2]=100; assert(hasteReply(b)->reading->power==Power::full);
    auto c=compxQuery(CompxCommand::identity);
    assert(!compxIdentity(c)); c[5]=2; c[6]=2; c[7]=27;
    const auto fix=[&]{c[16]=compxChecksum(std::span(c).first(16));};
    fix(); assert(compxIdentity(c)); c[7]=7; fix(); assert(!compxIdentity(c));
    c=compxQuery(CompxCommand::link); assert(!compxLink(c));
    c[5]=4; fix(); assert(compxLink(c)==0); c[6]=1; fix(); assert(!compxLink(c));
    c[7]=1; c[8]=2; c[9]=3; fix(); assert(compxLink(c)==0x030201);
    c=compxQuery(CompxCommand::battery); assert(!compxBattery(c));
    c[5]=4; c[6]=41; c[7]=1; fix();
    assert(compxBattery(c)->reading->low==41 && compxBattery(c)->reading->power==Power::unknown);
    std::array<std::uint8_t,32> padded{};
    for (std::size_t i=0;i<c.size();++i) padded[i]=c[i];
    assert(compxBattery(padded));
    padded[18]=1; assert(!compxBattery(padded));
    c[16]^=1; assert(!compxBattery(c));
}
