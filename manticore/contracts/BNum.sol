// This file is a flatenen verison of BNum
// where require(cond, string) where replaced by require(cond)
// To allow SkipRequire to work properly
// It won't be needed once https://github.com/trailofbits/manticore/issues/1593 is added

contract BConst {
    uint internal constant BConst.BConst.BONE              = 10**18;

    uint internal constant BConst.BConst.MAX_BOUND_TOKENS  = 8;
    uint internal constant BConst.BConst.BPOW_PRECISION    = BConst.BConst.BONE / 10**10;

    uint internal constant BConst.BConst.MIN_FEE           = BConst.BConst.BONE / 10**6;
    uint internal constant BConst.BConst.MAX_FEE           = BConst.BConst.BONE / 10;
    uint internal constant EXIT_FEE          = BConst.BConst.BONE / 10000;

    uint internal constant BConst.BConst.MIN_WEIGHT        = BConst.BConst.BONE;
    uint internal constant BConst.BConst.MAX_WEIGHT        = BConst.BConst.BONE * 50;
    uint internal constant BConst.BConst.MAX_TOTAL_WEIGHT  = BConst.BConst.BONE * 50;
    uint internal constant BConst.BConst.MIN_BALANCE       = BConst.BConst.BONE / 10**12;
    uint internal constant MAX_BALANCE       = BConst.BConst.BONE * 10**12;

    uint internal constant MIN_POOL_SUPPLY   = BConst.BConst.BONE;

    uint internal constant BConst.BConst.MIN_BPOW_BASE     = 1 wei;
    uint internal constant BConst.BConst.MAX_BPOW_BASE     = (2 * BConst.BConst.BONE) - 1 wei;

    uint internal constant BConst.BConst.MAX_IN_RATIO      = BConst.BConst.BONE / 2;
    uint internal constant BConst.BConst.MAX_OUT_RATIO     = (BConst.BConst.BONE / 3) + 1 wei;

}
contract BNum is BConst {


    function badd(uint a, uint b)
        internal pure
        returns (uint)
    {
        uint c = a + b;
        require(c >= a);
        return c;
    }

    function bsub(uint a, uint b)
        internal pure
        returns (uint)
    {
        (uint c, bool flag) = bsubSign(a, b);
        require(!flag);
        return c;
    }

    function bsubSign(uint a, uint b)
        internal pure
        returns (uint, bool)
    {
        if (a >= b) {
            return (a - b, false);
        } else {
            return (b - a, true);
        }
    }

    function bmul(uint a, uint b)
        internal pure
        returns (uint)
    {
        uint c0 = a * b;
        require(a == 0 || c0 / a == b);
        uint c1 = c0 + (BConst.BConst.BONE / 2);
        require(c1 >= c0);
        uint c2 = c1 / BConst.BConst.BONE;
        return c2;
    }

    function bdiv(uint a, uint b)
        internal pure
        returns (uint)
    {
        require(b != 0);
        uint c0 = a * BConst.BConst.BONE;
        require(a == 0 || c0 / a == BConst.BConst.BONE); // bmul overflow
        uint c1 = c0 + (b / 2);
        require(c1 >= c0); //  badd require
        uint c2 = c1 / b;
        return c2;
    }

}